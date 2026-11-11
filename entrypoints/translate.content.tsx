import ReactDOM from 'react-dom/client';
import { ContentApp } from '../src/content/App';
import { isSupportedUrl } from '../src/core/rpc';
import '../src/content/content.css';
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    if (!isSupportedUrl(location.href) || document.contentType === 'application/pdf') return;
    const ui = await createShadowRootUi(ctx, {
      name: 'yijing-translate',
      position: 'overlay',
      zIndex: 2147483647,
      onMount(container, _shadow, host) {
        host.dataset.yijingUi = 'true';
        const app = document.createElement('div');
        for (const type of [
          'click',
          'pointerdown',
          'pointermove',
          'pointerup',
          'keydown',
          'keyup',
          'submit',
        ]) {
          app.addEventListener(
            type,
            (event) => {
              if (!event.isTrusted) {
                event.preventDefault();
                event.stopImmediatePropagation();
              }
            },
            true,
          );
        }
        container.append(app);
        const root = ReactDOM.createRoot(app);
        const render = () => root.render(<ContentApp key={location.href} host={host} />);
        render();
        ctx.addEventListener(window, 'wxt:locationchange', render);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
