
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Removed manual process.env polyfill and localStorage handling for API_KEY
// The environment handles the API_KEY variable externally.

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
