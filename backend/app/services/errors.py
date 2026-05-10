class ServiceError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class NotFoundError(ServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 404)


class ConflictError(ServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 409)


class ValidationError(ServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 400)


class UpstreamError(ServiceError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message, status_code)
