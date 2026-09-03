import { RouterProvider } from '@tanstack/react-router';
import { previewRouter } from './routeTree';

/** Mounts the P4 5.3 scaffold's own isolated router — see routeTree.tsx. */
export function RouterPreviewIsland() {
  return <RouterProvider router={previewRouter} />;
}
