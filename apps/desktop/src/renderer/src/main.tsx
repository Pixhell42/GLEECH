import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installRangeFill } from './range-fill';
import './styles.css';
import './timeline.css';
import './render.css';
import { applyUiColor, readUiColor } from './ui-color';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
installRangeFill(root);
applyUiColor(readUiColor());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
