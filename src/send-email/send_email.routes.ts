/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono';
import { SendEmailService } from './send_email.service';
import { SendEmailRepository } from './send_email.repository';
import z from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Bindings } from '..';

// Initialize the main router instance with the Cloudflare Workers Bindings type
const SendEmailRouter = new Hono<{ Bindings: Bindings }>();

// Define and enforce the expected payload format for sending emails
const EmailSchema = z.object({
  // Zod requires the string type declared first so it knows what it's parsing
  to: z.email({ message: "Please provide a valid email address." }).trim(),

  subject: z.string().trim().min(3, { message: "Subject must be at least 3 characters." }),

  text: z.string().trim().min(10, { message: "Plain text body must be at least 10 characters." }),

  html: z.string().trim().min(1, { message: "HTML content cannot be empty." }),
}).strict(); // Block extra properties not explicitly declared in the schema

/**
 * Attaches the email dispatch POST route to the provided Hono router.
 */
export function sendEmailRoute(SendEmailRouter: Hono<{ Bindings: Bindings }>) {
  
  // Lazy-loaded dependencies initialized as null because c.env is only available during request runtime
  let sendEmailService: SendEmailService | null = null;
  let sendEmailRepo: SendEmailRepository | null = null; 

  SendEmailRouter.post(
    '', 
    // Step 1: Request payload validation middleware using Zod
    zValidator('json', EmailSchema, (result, c) => {
      if (!result.success) {
        // Flatten the deep Zod error stack into an easily readable object
        const errors = z.flattenError(result.error); 
        
        return c.json({
          error: 'Validation failed',
          details: {
            fieldErrors: errors.fieldErrors, // Specific issues tied to fields (e.g., "to", "subject")
            formErrors: errors.formErrors     // Issues tied to the structural root payload object
          }
        }, 400); // HTTP 400 Bad Request
      }
    }), 
    // Step 2: Core route execution handler (runs if schema validation passes)
    async (c) => {
      // Dynamic Dependency Injection: Instantiate repo and service using runtime bindings (c.env)
      sendEmailRepo = new SendEmailRepository(c.env.makisend_db);
      sendEmailService = new SendEmailService(c.env, sendEmailRepo);
      
      // Parse out the request body JSON
      const body = await c.req.json();

      // Final schema alignment parsing 
      const data = EmailSchema.parse(body);
      
      // Execute the business logic layer to handle cryptography, delivery, and DB logging
      const result = await sendEmailService.sendEmail(data);
      
      // Return successful response package with a 201 Created status
      return c.json({ success: true, data: result }, 201);
    }
  );
}

export default SendEmailRouter;
