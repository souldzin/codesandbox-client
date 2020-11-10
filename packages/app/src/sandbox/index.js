import { camelizeKeys } from 'humps';
import { isStandalone, listen, dispatch } from 'codesandbox-api';
import _debug from '@codesandbox/common/lib/utils/debug';

import registerServiceWorker from '@codesandbox/common/lib/registerServiceWorker';
import requirePolyfills from '@codesandbox/common/lib/load-dynamic-polyfills';
import { getModulePath } from '@codesandbox/common/lib/sandbox/modules';
import { endMeasure } from '@codesandbox/common/lib/utils/metrics';
import { generateFileFromSandbox } from '@codesandbox/common/lib/templates/configuration/package-json';
import { getSandboxId } from '@codesandbox/common/lib/utils/url-generator';
import { getPreviewSecret } from 'sandbox-hooks/preview-secret';
import { show404 } from 'sandbox-hooks/not-found-screen';

import compile, { getCurrentManager } from './compile';
import { startSandpackController } from './sandpack/controller';

const host = process.env.CODESANDBOX_HOST;
const debug = _debug('cs:sandbox');

export const SCRIPT_VERSION =
  document.currentScript && document.currentScript.src;

debug('Booting sandbox v2');

endMeasure('boot', { lastTime: 0, displayName: 'Boot' });

const ID = Math.floor(Math.random() * 1000000);

requirePolyfills().then(() => {
  if (process.env.SANDPACK) {
    startSandpackController();
  } else {
    registerServiceWorker('/sandbox-service-worker.js', {});
  }

  function sendReady() {
    dispatch({ type: 'initialized', id: ID });
  }

  async function handleMessage(data, source) {
    if (source) {
      if (data.id && data.id !== ID) {
        return;
      }

      if (data.type === 'compile') {
        compile(data);
      } else if (data.type === 'get-transpiler-context') {
        const manager = getCurrentManager();

        if (manager) {
          const context = await manager.getTranspilerContext();
          dispatch({
            type: 'transpiler-context',
            data: context,
          });
        } else {
          dispatch({
            type: 'transpiler-context',
            data: {},
          });
        }
      }
    }
  }

  if (!isStandalone) {
    listen(handleMessage);

    sendReady();
  }

  if (process.env.NODE_ENV === 'test' || isStandalone) {
    // We need to fetch the sandbox ourselves...
    const id = getSandboxId();
    window
      .fetch(host + `/api/v1/sandboxes/${id}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${getPreviewSecret()}`,
        },
        credentials: 'include',
        mode: 'cors',
      })
      .then(res => {
        if (res.status === 404) {
          show404(id);
        }
        return res.json();
      })
      .then(res => {
        const camelized = camelizeKeys(res);
        camelized.data.npmDependencies = res.data.npm_dependencies;

        return camelized;
      })
      .then(x => {
        const moduleObject = {};

        // We convert the modules to a format the manager understands
        x.data.modules.forEach(m => {
          const path = getModulePath(x.data.modules, x.data.directories, m.id);
          moduleObject[path] = {
            path,
            code: m.code,
          };
        });

        if (!moduleObject['/package.json']) {
          moduleObject['/package.json'] = {
            code: generateFileFromSandbox(x.data),
            path: '/package.json',
          };
        }

        const data = {
          sandboxId: id,
          modules: moduleObject,
          entry: '/' + x.data.entry,
          externalResources: x.data.externalResources,
          dependencies: x.data.npmDependencies,
          hasActions: false,
          template: x.data.template,
          version: 3,
          disableDependencyPreprocessing: document.location.search.includes(
            'csb-dynamic-download'
          ),
        };

        compile(data);
      });
  }
});
