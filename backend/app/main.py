import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .routers import chat, expand, persistence, search, usage

logger = logging.getLogger(__name__)

app = FastAPI(title="Sediment API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://sediment-seven.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_request_size(request: Request, call_next):
    if request.method in {"POST", "PATCH", "PUT"} and request.url.path.startswith("/api/"):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                body_size = int(content_length)
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header."})
            if body_size > settings.max_request_bytes:
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

app.include_router(search.router, prefix="/api")
app.include_router(expand.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(persistence.router, prefix="/api")
app.include_router(usage.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
