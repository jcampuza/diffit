import { getSelectedFile, useShallowAppSelector } from "../store";
import { useIsWorkerPoolReady } from "../workerPool";
import { DiffView } from "./DiffView";
import { FindBar, useFindState } from "./FindBar";
import { CleanState, ErrorState, LoadingState } from "./States";

export function DiffPanel() {
  const { error, isLoading, repository, revision, selectedFile, viewMode } = useShallowAppSelector((state) => ({
    error: state.error,
    isLoading: state.isLoading,
    repository: state.repository,
    revision: state.revision,
    selectedFile: getSelectedFile(state),
    viewMode: state.viewMode,
  }));
  const findState = useFindState();
  const isWorkerPoolReady = useIsWorkerPoolReady();
  const showDiff = !isLoading && !error && repository && selectedFile && isWorkerPoolReady;

  return (
    <section className="diff-panel">
      {isLoading || (!error && repository && selectedFile && !isWorkerPoolReady) ? <LoadingState /> : null}
      {!isLoading && error ? <ErrorState message={error} /> : null}
      {!isLoading && !error && repository && repository.files.length === 0 ? <CleanState revision={revision} /> : null}
      {showDiff ? (
        <DiffView activeFindMatch={findState.activeMatch} file={selectedFile} repository={repository} viewMode={viewMode} />
      ) : null}
      <FindBar findState={findState} />
    </section>
  );
}
