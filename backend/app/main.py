from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import search

app = FastAPI(title="Sediment API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://sediment.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
