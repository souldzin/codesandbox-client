import {
  MESSAGE_RESPONSE,
  REQUEST_FLUSH_DELAY,
  REQUEST_FLUSH_INTERVAL,
  SandpackResponsePayload,
  createRequestEvent,
} from './constants';
import { DeferredRequestsCollection } from './deferred-requests';
import { createInactivityTrigger } from './inactivity-trigger';

type DeferredRequest = {
  request: Request;
  resolve: (Response) => void;
  reject: (Error) => void;
};

const HOST = `${location.protocol}//${location.host}`;
const ASSETS_PATH = '/assets.json';

const sw: any = self;
const passthroughPaths = new Set(['/', '/index.html', ASSETS_PATH]);
const requests = new DeferredRequestsCollection();

const passthroughRequestAndSave = (requestId: string) => {
  requests
    .passthrough(requestId)
    .then(({ request, response }) => {
      if (!response.ok) {
        return;
      }

      const path = getPath(request.url);
      debug('[sw!!!!!] flushed request with path', path);
      passthroughPaths.add(path);
    })
    .catch(() => {
      // Do nothing. Already caught in the deferred requests resolve/reject.
    });
};

const requestFlusher = createInactivityTrigger({
  delay: REQUEST_FLUSH_DELAY,
  interval: REQUEST_FLUSH_INTERVAL,
  cb() {
    Array.from(requests.keys()).forEach(passthroughRequestAndSave);
  },
});

requestFlusher.start();

const debug = (...args) => {
  // eslint-disable-next-line no-console
  console.log(...args);
};

const getPath = url => `/${url.replace(/^https?:\/\/[^/]+\/?/, '')}`;

const fetchAndUpdatePassthrough = () =>
  fetchWebpackAssets()
    .then(assets => {
      debug('[sw] fetch update passthrough', assets);

      assets.forEach(x => passthroughPaths.add(x));
    })
    .catch(e => {
      debug('[sw] failed to update passthrough paths with assets', e);
    });

const fetchWebpackAssets = () =>
  fetch(ASSETS_PATH)
    .then(x => x.json())
    .then(assets => {
      debug('[sw] fetchWebpackAssets assets', assets);
      return [].concat(
        ...Object.values(assets).map(entry => Object.values(entry))
      );
    });

const handleResponse = ({
  requestId,
  content,
  contentType,
  isFile,
}: SandpackResponsePayload) => {
  requestFlusher.notify();

  if (isFile) {
    requests.respond(
      requestId,
      new Response(content, {
        headers: {
          'Content-Type': contentType,
        },
      })
    );
  } else {
    passthroughRequestAndSave(requestId);
  }
};

sw.addEventListener('install', event => {
  sw.skipWaiting();
  event.waitUntil(fetchAndUpdatePassthrough());
});

sw.addEventListener('activate', event => {
  // Start intercepting immediately...
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener('fetch', event => {
  requestFlusher.notify();
  const { request, clientId } = event as { request: Request; clientId: string };

  debug('[sw] trying to fetch', request.url, clientId);

  if (!request.url.startsWith(HOST)) {
    return;
  }

  const path = getPath(request.url);

  if (passthroughPaths.has(path)) {
    return;
  }

  debug('[sw] trying to fetch path', path);

  const response = sw.clients.get(clientId).then(
    client =>
      new Promise<Response>((resolve, reject) => {
        const requestId = requests.create({ request, resolve, reject });

        if (client) {
          debug('[sw] posting message to client', path, requestId);
          client.postMessage(createRequestEvent({ path, requestId }));
        }
      })
  );

  event.respondWith(response);
});

sw.addEventListener('message', event => {
  debug('[sw] got a message', event);
  const { type, payload } = event.data || {};

  switch (type) {
    case MESSAGE_RESPONSE:
      handleResponse(payload);
      break;
  }
});
