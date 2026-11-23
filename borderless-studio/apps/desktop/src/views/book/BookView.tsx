/** The Book screen: details, editions, interior design and front and back matter. */
import { useState } from 'react';
import { BookTitle } from '../../App';
import { DetailsTab } from './DetailsTab';
import { EditionsTab } from './EditionsTab';
import { DesignTab } from './DesignTab';
import { MatterTab } from './MatterTab';

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'editions', label: 'Editions' },
  { id: 'design', label: 'Interior design' },
  { id: 'matter', label: 'Front and back matter' },
] as const;
type TabId = (typeof TABS)[number]['id'];

let lastTab: TabId = 'details';

export function BookView() {
  const [tab, setTabState] = useState<TabId>(lastTab);
  const setTab = (t: TabId) => {
    lastTab = t;
    setTabState(t);
  };
  return (
    <>
      <div className="topbar">
        <BookTitle />
        <div className="grow" />
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'design' ? <DesignTab /> : (
        <div className="page">
          {tab === 'details' && <DetailsTab />}
          {tab === 'editions' && <EditionsTab />}
          {tab === 'matter' && <MatterTab />}
        </div>
      )}
    </>
  );
}
