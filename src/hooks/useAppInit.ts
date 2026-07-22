import { useEffect } from "react";
import { loadAppSettings } from "../services/settingsService";
import { listLists } from "../services/listService";
import { useTaskStore } from "../stores/taskStore";
import { defaultAppSettings, type AppSettings } from "../types/settings";
import { normalizeError } from "../utils/taskHelpers";

export function useAppInit(
  setSettings: (settings: AppSettings) => void,
  setLists: (lists: import("../types/database").TaskList[]) => void,
  setAppError: (error: string | null) => void,
) {
  const loadTasks = useTaskStore((state) => state.loadTasks);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const [nextSettings, nextLists] = await Promise.all([
          loadAppSettings(),
          listLists(),
        ]);
        if (cancelled) return;
        setSettings(nextSettings);
        setLists(nextLists);
        await loadTasks();
      } catch (nextError) {
        if (!cancelled) setAppError(normalizeError(nextError));
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [loadTasks, setSettings, setLists, setAppError]);
}

export { defaultAppSettings };
