import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ArrowDownUp, Plus } from 'lucide-react';
import { ProjectCard } from '../components/ProjectCard';
import { SearchControl, SearchField } from '@/components/SearchControl';
import { NewProjectDialog } from '../components/Dialogs';
import { useWorkspace } from '@/store/WorkspaceProvider';
import { PROJECT_SORTS } from '@/lib/mockData';

export function ProjectsView() {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { projects, projectQuery, setProjectQuery, projectSort, setProjectSort, createProject } = useWorkspace();

  const q = projectQuery.toLowerCase();
  let list = projects.filter((p) => !q || `${p.title} ${p.desc}`.toLowerCase().includes(q));
  if (projectSort === 'Alphabetical') list = [...list].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet pt-[26px] px-[32px] pb-[32px] animate-viewIn">
      <div className="max-w-[940px] mx-auto">
        <div className="flex items-center gap-[10px]">
          <h1 className="m-0 flex-1 text-[24px] font-[600] tracking-[-.015em]">Projects</h1>
          <div className="flex items-center gap-[4px]">
            <SearchControl
              size="lg"
              open={searchOpen}
              onToggle={() => {
                setSearchOpen((v) => !v);
                setProjectQuery('');
              }}
              label="Search projects"
            />
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  aria-label="Sort projects"
                  className="w-[32px] h-[32px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-muted cursor-pointer hover:bg-accent-soft hover:text-accent"
                >
                  <ArrowDownUp size={17} strokeWidth={1.9} />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  align="end"
                  sideOffset={6}
                  className="z-[60] w-[184px] p-[5px] bg-raised border border-line-strong rounded-[12px] shadow-pop data-[state=open]:animate-fadeUp motion-reduce:animate-none"
                >
                  {PROJECT_SORTS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setProjectSort(opt)}
                      className="flex items-center justify-between w-full h-[30px] px-[9px] border-0 bg-transparent rounded-[8px] font-sans text-[12.5px] text-ink cursor-pointer hover:bg-tint2"
                    >
                      <span>{opt}</span>
                      <span className="text-accent">{projectSort === opt ? '✓' : ''}</span>
                    </button>
                  ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-[7px] h-[32px] px-[13px] border-0 rounded-[10px] bg-accent text-white font-sans text-[13px] font-[500] cursor-pointer hover:bg-accent-hover"
            >
              <Plus size={15} strokeWidth={2} />
              New project
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="mt-[14px]">
            <SearchField
              size="lg"
              value={projectQuery}
              onChange={setProjectQuery}
              placeholder="Search projects by title or description…"
            />
          </div>
        )}

        <p className="mt-[8px] mb-[20px] text-[13px] text-ink-faint">
          {list.length} projects · sorted by {projectSort.toLowerCase()}
        </p>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-[14px]">
          {list.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/projects/${p.id}`)} />
          ))}
        </div>
      </div>

      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={async ({ name, goal }) => {
          const project = await createProject({ name, goal });
          setDialogOpen(false);
          navigate(`/projects/${project.id}`);
        }}
      />
    </div>
  );
}
