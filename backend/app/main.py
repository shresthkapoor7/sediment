from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .routers import chat, expand, persistence, search, usage

ALLOWED_ORIGINS = {"http://localhost:3000", "https://sediment-seven.vercel.app"}

app = FastAPI(title="Sediment API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_browser_origin(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        origin = request.headers.get("origin") or request.headers.get("referer", "")
        allowed = any(origin.startswith(o) for o in ALLOWED_ORIGINS)
        if not allowed:
            return JSONResponse(
                status_code=403,
                content={"detail": "Direct API access is not permitted."},
            )
    return await call_next(request)

app.include_router(search.router, prefix="/api")
app.include_router(expand.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(persistence.router, prefix="/api")
app.include_router(usage.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
