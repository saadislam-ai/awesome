/** The Publish screen: prices, the retail listing, ISBNs, the publishing checklist, and audiobook preparation. */
import { useState } from 'react';
import { BookTitle } from '../../App';
import { PricingTab } from './PricingTab';
import { ListingTab } from './ListingTab';
import { IsbnTab } from './IsbnTab';
import { ChecklistTab } from './ChecklistTab';
import { AudiobookTab } from './AudiobookTab';

const TABS = [
  { id: 'prices', label: 'Prices' },
  { id: 'listing', label: 'Listing' },
  { id: 'isbn', label: 'ISBNs' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'audiobook', label: 'Audiobook' },
] as const;
type TabId = (typeof TABS)[number]['id'];
let lastTab: TabId = 'prices';

export function PublishView() {
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
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
      </div>
      <div className="page">
        {tab === 'prices' && <PricingTab />}
        {tab === 'listing' && <ListingTab />}
        {tab === 'isbn' && <IsbnTab />}
        {tab === 'checklist' && <ChecklistTab />}
        {tab === 'audiobook' && <AudiobookTab />}
      </div>
    </>
  );
}
