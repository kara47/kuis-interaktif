import { getStore } from '@netlify/blobs';
import { handle } from '../lib/handler.mjs';

export default (req, context) =>
  handle(req, {
    store: getStore({ name: 'kuis', consistency: 'strong' }),
    ip: context.ip,
    id: context.params.id,
  });

export const config = { path: ['/api/kuis', '/api/kuis/:id'] };
