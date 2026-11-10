import { createRoot } from 'react-dom/client';
import App from './App';
import { feed } from './lib/feed';
import './styles.css';

feed.connect();
feed.startPing();
createRoot(document.getElementById('root')!).render(<App />);
