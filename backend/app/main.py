import logging
from contextlib import asynccontextmanager
from ipaddress import ip_address, ip_network
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .routers import changelog, chat, clarify, expand, paper_access, persistence, search, usage
from .services.paper_ingestion import shutdown_paper_parse_executor

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        yield
    finally:
        shutdown_paper_parse_executor()


app = FastAPI(title="Sediment API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://sediment-seven.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _normalize_ip(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        return str(ip_address(candidate))
    except ValueError:
        return None


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _trusted_proxy_ips() -> set[str]:
    return set(_split_csv(settings.trusted_proxies))


def _trusted_proxy_networks() -> list:
    networks = []
    for value in _split_csv(settings.trusted_proxy_cidrs):
        try:
            networks.append(ip_network(value, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid trusted proxy CIDR %r", value)
    return networks


def _is_trusted_proxy(peer_host: Optional[str]) -> bool:
    normalized_peer = _normalize_ip(peer_host)
    if not normalized_peer:
        return False

    if normalized_peer in _trusted_proxy_ips():
        return True

    peer_ip = ip_address(normalized_peer)
    return any(peer_ip in network for network in _trusted_proxy_networks())


def _resolve_verified_client_ip(request: Request) -> Optional[str]:
    peer_host = request.client.host if request.client else None

    if settings.trust_railway_proxy_headers and _is_trusted_proxy(peer_host):
        real_ip = _normalize_ip(request.headers.get("X-Real-IP"))
        if real_ip:
            return real_ip

        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            forwarded_ip = _normalize_ip(forwarded_for.split(",")[0])
            if forwarded_ip:
                return forwarded_ip

    if request.client:
        return _normalize_ip(request.client.host) or request.client.host
    return None


@app.middleware("http")
async def resolve_client_ip(request: Request, call_next):
    verified_client_ip = _resolve_verified_client_ip(request)
    if verified_client_ip:
        request.state.verified_client_ip = verified_client_ip
    return await call_next(request)


@app.middleware("http")
async def enforce_request_size(request: Request, call_next):
    if request.method in {"POST", "PATCH", "PUT"} and request.url.path.startswith("/api/"):
        body = await request.body()
        if len(body) > settings.max_request_bytes:
            return JSONResponse(status_code=413, content={"detail": "Request body too large."})
    return await call_next(request)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code >= 500:
        logger.warning("HTTP %s on %s", exc.status_code, request.url.path)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s", request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})

app.include_router(changelog.router, prefix="/api")
app.include_router(clarify.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(expand.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(persistence.router, prefix="/api")
app.include_router(paper_access.router, prefix="/api")
app.include_router(usage.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
