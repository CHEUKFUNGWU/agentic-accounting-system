import {createRoot} from 'react-dom/client';
import AuthGate from './AuthGate';
import './index.css';
import './skin.css';

// Appearance only. AuthGate and authenticated workspace preferences remain authoritative.
document.documentElement.dataset.ui = 'reader';
document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);

createRoot(document.getElementById('root')!).render(<AuthGate />);
