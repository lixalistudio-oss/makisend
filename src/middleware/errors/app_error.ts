import { StatusCode } from "hono/utils/http-status"

export class AppError extends Error
{
    constructor (public statusCode : StatusCode , message : string)
    {
        super(message) // Call the proper JS Error class to fire the object actual implementation and giving it a proper message 

        this.name = this.constructor.name // Allow to replace the name of the instance (generally "Error") to the specific of the current class being written

        Error.captureStackTrace(this,this.constructor) // Allow to create a proper stackTrace of the error and hide the constructor of the current function from being shown in terminal

    }
}

export class BadRequestError extends AppError
{
    constructor(message = "Bad Request")
    {
      super(400,message)
    }
}

export class NotFoundError extends AppError
{
    constructor(message = "Not Found")
    {
      super(404,message)
    }
}

export class UnauthorizedError extends AppError
{
    constructor(message = "Unauthorized")
    {
      super(401,message)
    }
}