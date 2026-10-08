import { useEffect, useState } from 'react';
import Lista from './Lista.jsx';
import Review from './Review.jsx';

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const m = /^#\/ddt\/(\d+)/.exec(useHash());
  return (
    <>
      <header><a href="#/">Artigeniale · Carico acquisti da DDT</a></header>
      <main className={m ? 'wide' : ''}>
        {m ? <Review key={m[1]} id={Number(m[1])} /> : <Lista />}
      </main>
    </>
  );
}