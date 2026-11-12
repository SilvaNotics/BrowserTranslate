import ReactDOM from 'react-dom/client';
import { ContentApp } from '../src/content/App';
import { isSupportedUrl } from '../src/core/rpc';
import { isolatedUiEvents, prepareContentHost } from '../src/content/host';
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
      anchor: 'html',
      inheritStyles: true,
      isolateEvents: isolatedUiEvents,
      zIndex: 2147483647,
      onMount(container, _shadow, host) {
        const disposeHost = prepareContentHost(host, container);
        const app = document.createElement('div');
        container.append(app);
        const root = ReactDOM.createRoot(app);
        const render = () => root.render(<ContentApp key={location.href} host={host} />);
        render();
        return { root, render, disposeHost };
      },
      onRemove(mounted) {
        mounted?.disposeHost();
        mounted?.root.unmount();
      },
    });
    if (ctx.isInvalid) return;
    ctx.addEventListener(window, 'wxt:locationchange', () => ui.mounted?.render());
    ui.mount();
  },
});
