"""
NARCHI V5 — Global Exception Handlers
Centralized error handling for FastAPI application.
"""

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from pydantic import ValidationError

from app.core.logging import get_logger

logger = get_logger("exceptions")


def register_exception_handlers(app: FastAPI) -> None:
    """
    Register all global exception handlers for the FastAPI application.
    """

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        """Handle Pydantic validation errors with structured response."""
        errors = []
        for error in exc.errors():
            field = " -> ".join(str(loc) for loc in error["loc"])
            errors.append(f"Field {field}: {error['msg']}")

        logger.warning(
            "Validation failed",
            extra={
                "path": request.url.path,
                "method": request.method,
                "errors": errors,
                "client_host": request.client.host if request.client else "unknown"
            }
        )

        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "status": "error",
                "type": "VALIDATION_FAILED",
                "message": "The provided data is invalid.",
                "details": errors,
            },
        )

    @app.exception_handler(ValidationError)
    async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
        """Handle Pydantic validation errors (non-FastAPI)."""
        errors = [f"{e['loc']}: {e['msg']}" for e in exc.errors()]

        logger.warning(
            "Pydantic validation failed",
            extra={"path": request.url.path, "errors": errors}
        )

        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "status": "error",
                "type": "VALIDATION_FAILED",
                "message": "Data validation failed.",
                "details": errors,
            },
        )

    @app.exception_handler(SQLAlchemyError)
    async def sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError):
        """Handle database errors."""
        logger.error(
            "Database error",
            extra={
                "path": request.url.path,
                "method": request.method,
                "error": str(exc),
                "error_type": type(exc).__name__
            },
            exc_info=True
        )

        # Don't expose internal DB details in production
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status": "error",
                "type": "DATABASE_ERROR",
                "message": "A database error occurred. Please try again later.",
            },
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, exc: IntegrityError):
        """Handle database integrity constraint violations."""
        logger.warning(
            "Integrity constraint violation",
            extra={
                "path": request.url.path,
                "method": request.method,
                "error": str(exc.orig) if exc.orig else str(exc)
            }
        )

        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "status": "error",
                "type": "INTEGRITY_ERROR",
                "message": "Data conflict: a constraint was violated (duplicate, foreign key, etc.).",
            },
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        """Catch-all for unhandled exceptions."""
        logger.critical(
            "Unhandled exception",
            extra={
                "path": request.url.path,
                "method": request.method,
                "error": str(exc),
                "error_type": type(exc).__name__
            },
            exc_info=True
        )

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status": "error",
                "type": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred. Please contact support.",
            },
        )