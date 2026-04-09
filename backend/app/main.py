from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import chat, expand, persistence, search

app = FastAPI(title="Sediment API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://sediment-seven.vercel.app/"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api")
app.include_router(expand.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(persistence.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
