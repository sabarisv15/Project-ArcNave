import { forwardRef } from 'react';
import { AIComposer } from '@/features/chat';

/**
 * The artifact workspace composer: content only, no dock wrapper — the caller
 * renders it inside the shared `ChatComposerDock`. Aware of whether it is
 * creating the artifact or revising the one currently on the canvas.
 *
 * It owns no composer state of its own. The artifact route passes its own
 * scoped draft in, so artifact A's revision draft cannot surface in artifact
 * B, and nothing typed on Home or in a project can surface here.
 */
export const ArtifactRevisionComposer = forwardRef(function ArtifactRevisionComposer(
  { revising, artifactType, composer, onSend },
  ref,
) {
  return (
    <AIComposer
      ref={ref}
      composer={composer}
      value={composer.text}
      onChange={composer.setText}
      onSend={onSend}
      mode={composer.mode}
      onMode={composer.setMode}
      thinkingLevel={composer.thinkingLevel}
      onThinkingLevel={composer.setThinkingLevel}
      variant="chat"
      placeholder={
        revising
          ? 'Describe what you want to change…'
          : `Describe the ${(artifactType || 'document').toLowerCase()} you want ArcNave to create…`
      }
    />
  );
});
