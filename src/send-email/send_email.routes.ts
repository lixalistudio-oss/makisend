import { Hono } from 'hono';
import { SendEmailService} from './send_email.service';

export function sendEmailRoute(app: Hono, sendEmailService: SendEmailService) {
  app.post('/users', async (c) => {
    try {
      const body = await c.req.json();
      
      // Execute the injected service layer
      const result = await sendEmailService.sendEmail();
      
      return c.json({ success: true, data: result }, 201);
    } catch (error: any) {
      // Catch exceptions thrown by the service and turn them into bad requests
      return c.json({ success: false, error: error.message }, 400);
    }
  });
}
