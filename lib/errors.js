// error ที่ service โยนออกมา route แปลงเป็น HTTP อีกที service ไม่รู้จัก HTTP
export class ValidationError extends Error {}
export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
