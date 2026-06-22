import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

export interface ApiClientOptions {
  baseUrl: string;
  /** Optionnel en 3.11a (non branché). Sera fourni par l'app en 3.11b. */
  getToken?: () => string | undefined | Promise<string | undefined>;
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl });

  if (getToken) {
    const authMiddleware: Middleware = {
      async onRequest({ request }) {
        const token = await getToken();
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
        return request;
      },
    };
    client.use(authMiddleware);
  }

  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
