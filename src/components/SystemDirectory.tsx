'use client';

/**
 * Searchable, filterable system directory.
 *
 * The only substantial client island in the portal. Filtering happens in the
 * browser because the catalogue is small and already on the page; a round trip
 * to re-filter twelve items would be slower and less responsive.
 *
 * Accessibility notes that matter here:
 *  - the result count is a live region, so a screen reader hears the change
 *  - the empty state explains *why* it is empty and offers the way out
 *  - the search field is a real labelled input with a visible label, not a
 *    placeholder-only control
 */

import { useDeferredValue, useId, useMemo, useState } from 'react';
import { SystemTile, RestrictedTile } from './SystemTile';
import type { System, SystemCategory } from '@/lib/systems';

type Filter = 'all' | SystemCategory;

export function SystemDirectory({
  available,
  restricted,
}: {
  available: System[];
  restricted: System[];
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const searchId = useId();
  const countId = useId();

  // Keep typing responsive: the filter runs on the deferred value so a long
  // paste never blocks the keystroke that follows it.
  const deferredQuery = useDeferredValue(query);

  const all = useMemo(() => [...available, ...restricted], [available, restricted]);

  const categories = useMemo<Filter[]>(() => {
    const seen = new Set<SystemCategory>();
    for (const system of all) seen.add(system.category);
    return ['all', ...[...seen].sort()];
  }, [all]);

  const results = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();

    return all.filter((system) => {
      if (filter !== 'all' && system.category !== filter) return false;
      if (!needle) return true;
      // Match the things someone would actually type: name, what it does, owner.
      return (
        system.name.toLowerCase().includes(needle) ||
        system.shortName.toLowerCase().includes(needle) ||
        system.description.toLowerCase().includes(needle) ||
        system.owner.toLowerCase().includes(needle) ||
        system.category.toLowerCase().includes(needle)
      );
    });
  }, [all, deferredQuery, filter]);

  const launchableCount = results.filter(
    (system) => restricted.every((r) => r.slug !== system.slug),
  ).length;

  return (
    <div className="directory">
      <div className="directory-controls">
        <div className="search-field">
          <label className="visually-hidden" htmlFor={searchId}>
            Search systems
          </label>
          <svg
            className="search-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            id={searchId}
            className="search-input"
            type="search"
            placeholder="Search by name, function or office…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            aria-describedby={countId}
          />
        </div>

        <div className="filter-row" role="group" aria-label="Filter by category">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className="filter-chip"
              data-active={filter === category ? 'true' : undefined}
              aria-pressed={filter === category}
              onClick={() => setFilter(category)}
            >
              {category === 'all' ? 'All' : category}
            </button>
          ))}
        </div>
      </div>

      <p className="directory-count text-meta" id={countId} role="status" aria-live="polite">
        {results.length === all.length
          ? `${all.length} system${all.length === 1 ? '' : 's'}`
          : `${results.length} of ${all.length} systems`}
        {results.length > 0 ? ` · ${launchableCount} available to you` : ''}
      </p>

      {results.length === 0 ? (
        <div className="empty-state glass">
          <h3 className="display-2">No systems match</h3>
          <p className="text-body">
            Nothing in the catalogue matches “{deferredQuery.trim()}”
            {filter !== 'all' ? ` in ${filter}` : ''}. Try a shorter term, or clear the filters.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-md"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            <span className="btn-label">Clear filters</span>
          </button>
        </div>
      ) : (
        <ul className="tile-grid">
          {results.map((system) => {
            const isRestricted = restricted.some((candidate) => candidate.slug === system.slug);
            return (
              <li key={system.slug} className="tile-grid-item">
                {isRestricted ? <RestrictedTile system={system} /> : <SystemTile system={system} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
