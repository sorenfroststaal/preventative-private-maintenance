import { ModuleTitle } from './module-icon';
import { useEffect, useState } from 'react';

type Dish = { id: string; name: string };

export function Food({ local, run }: {
  local: <T>(action: string, data?: unknown) => Promise<T>;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    local<Dish[]>('recipes').then(rows => { if (active) setDishes(rows); })
      .catch(error => { if (active) setNotice(String(error)); });
    return () => { active = false; };
  }, [local]);

  return <><ModuleTitle name="Madplan" /><h2>Opskrifter</h2>
    {dishes.length === 0 && <p>Saml de retter, du vil bruge i din madplan.</p>}
    <button onClick={() => void run(async () => {
      const count = await local<number>('addStarterCatalog');
      setDishes(await local<Dish[]>('recipes'));
      setNotice(count ? count + ' retter tilføjet.' : 'Retterne fra startkataloget findes allerede i arkivet.');
    })}>Tilføj startkatalog</button>
    <p role="status">{notice}</p>
    <ul className="records">{dishes.map(dish => <li key={dish.id}>{dish.name}</li>)}</ul>
  </>;
}
