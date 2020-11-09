import registerServiceWorker from '@codesandbox/common/lib/registerServiceWorker';
import { getCurrentManager } from '../compile';
import {
  SandpackRequestPayload,
  createResponseEvent,
  MESSAGE_REQUEST,
} from './constants';

const ASSETS_PATH = '/assets.json';
const ASSET_SANDPACK_SERVICE_WORKER = 'sandpack-service-worker';

const debug = (...args) => {
  // eslint-disable-next-line no-console
  console.log(...args);
};

const postServiceWorkerMessage = data => {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.ready.then(() => {
    navigator.serviceWorker.controller.postMessage(data);
  });
};

const handleRequest = async ({ requestId, path }: SandpackRequestPayload) => {
  debug('[sandpack-controller] handle request', requestId, path);
  const manager = getCurrentManager();

  debug('hasManager ', Boolean(manager));
  if (!manager) {
    postServiceWorkerMessage(createResponseEvent({ requestId, isFile: false }));
    return;
  }

  const isFile = await new Promise<boolean>(resolve =>
    manager.isFile(path, resolve, resolve)
  );

  debug('isFile ', isFile);

  if (!isFile) {
    postServiceWorkerMessage(createResponseEvent({ requestId, isFile: false }));
    return;
  }

  const content = await new Promise<string>(resolve =>
    manager.readFileSync(path, resolve)
  );

  postServiceWorkerMessage(
    createResponseEvent({
      requestId,
      isFile: true,
      content,
      contentType: 'image/png',
    })
  );
};

const startSandpackServiceWorker = () =>
  fetch(ASSETS_PATH)
    .then(x => x.json())
    .then(assets => assets[ASSET_SANDPACK_SERVICE_WORKER].js)
    .then(swPath => {
      debug('[sandpack-controller] registering service worker!', swPath);
      registerServiceWorker(swPath, {} as any);
    });

export const startSandpackController = async () => {
  await startSandpackServiceWorker();

  debug('[sandpack-controller] start listening...');

  // TODO - serviceWorker check
  navigator.serviceWorker.addEventListener('message', event => {
    const { type, payload } = event.data || {};
    debug('[sandpack-controller] receive message', type, payload);

    switch (type) {
      case MESSAGE_REQUEST:
        handleRequest(payload);
    }
  });
};
