from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.services.errors import ServiceError


def create_app() -> FastAPI:
    app = FastAPI(title="EIP Backend", version="0.1.0")
    app.include_router(api_router)

    @app.exception_handler(ServiceError)
    def handle_service_error(_request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.message})

    return app


app = create_app()
