import { render } from 'preact';
import { App } from './app.tsx';
import './styles.css';

const root = document.getElementById('app')!;
// #teacher → teacher view, #review → native language review (both loaded on demand); everything else is the learner app
const view = (h = location.hash) => (h.startsWith('#teacher') ? 'teacher' : h.startsWith('#review') ? 'review' : 'app');
const current = view();
if (current === 'teacher') void import('./teacher.tsx').then(({ Teacher }) => render(<Teacher />, root));
else if (current === 'review') void import('./review.tsx').then(({ Review }) => render(<Review />, root));
else render(<App />, root);
// switching views in the same tab (e.g. a join link opened where the teacher view is open) needs a fresh start
addEventListener('hashchange', () => { if (view() !== current) location.reload(); });
