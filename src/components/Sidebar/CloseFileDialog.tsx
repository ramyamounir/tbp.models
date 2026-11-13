import { useCloseRequest } from '../../state/closeRequest';
import { unsavedCount, useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { Dialog } from '../ui/Dialog';

/** The close-file confirmation; mounted once in App. */
export function CloseFileDialog() {
  const fileId = useCloseRequest((s) => s.fileId);
  const file = useViewerStore((s) => s.files.find((f) => f.id === fileId));
  const cancel = () => useCloseRequest.setState({ fileId: undefined });
  if (!file) return null;
  const n = unsavedCount(file);
  return (
    <Dialog
      open
      width={420}
      title={
        <span className="flex min-w-0 items-center gap-1">
          Close <DisplayName value={file.name} max={48} className="font-mono" />?
        </span>
      }
      subtitle={`${n} unsaved ${n === 1 ? 'edit' : 'edits'} will be lost.`}
      onCancel={cancel}
      footer={
        <>
          <button
            type="button"
            data-autofocus
            onClick={cancel}
            className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              cancel();
              useViewerStore.getState().closeFile(file.id);
            }}
            className="h-8 rounded-md bg-diff-only-a px-3 text-[13px] font-medium text-panel hover:opacity-90"
          >
            Close file
          </button>
        </>
      }
    />
  );
}
