/** 带错误码的业务异常；API 只返回错误码，文案由前端 i18n 渲染 */
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number = 400,
  ) {
    super(code)
  }
}

export const Errors = {
  badRequest: (code = 'BAD_REQUEST') => new AppError(code, 400),
  unauthorized: (code = 'UNAUTHORIZED') => new AppError(code, 401),
  forbidden: (code = 'FORBIDDEN') => new AppError(code, 403),
  notFound: (code = 'NOT_FOUND') => new AppError(code, 404),
  conflict: (code = 'CONFLICT') => new AppError(code, 409),
  locked: (code = 'LOCKED') => new AppError(code, 423),
  tooMany: (code = 'RATE_LIMITED') => new AppError(code, 429),
  internal: () => new AppError('INTERNAL', 500),
}
