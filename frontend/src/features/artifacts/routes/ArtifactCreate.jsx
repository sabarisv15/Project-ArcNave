import { Link, useNavigate } from 'react-router-dom';
import { ArtifactTypeSelector } from '../components/ArtifactTypeSelector';
import { useWorkspace } from '@/store/WorkspaceProvider';

/** Create with template — no AI composer until a form is chosen. */
export function ArtifactCreate() {
  const navigate = useNavigate();
  const { createArtifact } = useWorkspace();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet pt-[26px] pb-[34px] px-[32px] animate-viewIn">
      <div className="max-w-[820px] mx-auto">
        <div className="flex items-center gap-[6px] text-[12px] text-ink-faint">
          <Link to="/artifacts" className="text-ink-faint no-underline hover:text-accent hover:no-underline">
            Artifacts
          </Link>
          <span>/</span>
          <span className="text-ink-muted">Create with template</span>
        </div>
        <h1 className="mt-[10px] mb-[4px] text-[24px] font-[600] tracking-[-.015em]">What are you creating?</h1>
        <p className="m-0 mb-[24px] text-[13.5px] text-ink-muted">
          Choose a form to begin. ArcNave will tailor the composer to that output.
        </p>
        <ArtifactTypeSelector
          onSelect={async (type) => {
            const artifact = await createArtifact(type);
            navigate(`/artifacts/${artifact.id}`);
          }}
        />
      </div>
    </div>
  );
}
