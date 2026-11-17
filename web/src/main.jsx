import { render } from 'preact';
import { App } from './app.jsx';
import { useFolder, scanNow } from './lib/watch.js';
import './styles.css';

// Otomatik testler için küçük bir kanca (klasör seçme penceresi otomatik sürülemediği için).
window.__derkenar = { useFolder, scanNow };

render(<App />, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
