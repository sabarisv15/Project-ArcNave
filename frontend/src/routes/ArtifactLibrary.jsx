import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { ArtifactCard } from '../components/ArtifactCard';
import { SearchControl, SearchField } from '../components/SearchControl';
import { FilterControl } from '../components/FilterControl';
import { useWorkspace } from '../store/WorkspaceProvider';
import { ARTIFACT_FILTERS } from '../lib/mockData';

export function ArtifactLibrary() {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const { artifacts, artifactQuery, setArtifactQuery, artifactFilter, setArtifactFilter } = useWorkspace();

  const q = artifactQuery.toLowerCase();
  const list = artifacts.filter((a) => {
    if (q && !a.title.toLowerCase().includes(q)) return false;
    if (artifactFilter === 'All artifacts') return true;
    if (artifactFilter === 'Linked to a project') return !!a.link;
    if (artifactFilter === 'Generated today') return /hour/.test(a.edited);
    return a.type.includes(artifactFilter.replace(/s$/, ''));
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet pt-[26px] px-[32px] pb-[32px] animate-viewIn">
      <div className="max-w-[1000px] mx-auto">
        <div className="flex items-center gap-[10px]">
          <h1 className="m-0 flex-1 text-[24px] font-[600] tracking-[-.015em]">Artifacts</h1>
          <div className="flex items-center gap-[4px]">
            <SearchControl
              size="lg"
              open={searchOpen}
              onToggle={() => {
                setSearchOpen((v) => !v);
                setArtifactQuery('');
              }}
              label="Search artifacts"
            />
            <FilterControl
              size="lg"
              width={200}
              options={ARTIFACT_FILTERS}
              value={artifactFilter}
              onChange={setArtifactFilter}
              label="Filter artifacts"
            />
            <button
              type="button"
              onClick={() => navigate('/artifacts/new')}
              className="flex items-center gap-[7px] h-[32px] px-[13px] border-0 rounded-[10px] bg-accent text-white font-sans text-[13px] font-[500] cursor-pointer hover:bg-accent-hover"
            >
              <Plus size={15} strokeWidth={2} />
              New artifact
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="mt-[14px]">
            <SearchField size="lg" value={artifactQuery} onChange={setArtifactQuery} placeholder="Search artifacts…" />
          </div>
        )}

        <p className="mt-[8px] mb-[20px] text-[13px] text-ink-faint">
          {list.length} artifacts · {artifactFilter.toLowerCase()}
        </p>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[14px]">
          {list.map((a) => (
            <ArtifactCard key={a.id} artifact={a} onOpen={() => navigate(`/artifacts/${a.id}`)} />
          ))}
        </div>
      </div>
    </div>
  );
}
