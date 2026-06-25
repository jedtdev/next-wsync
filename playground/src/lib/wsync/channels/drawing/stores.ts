import { storage } from "next-wsync";
import type { DrawingStroke, DrawingPoint } from "./schema";

export const drawingStore = storage("drawing", {
  store: {
    strokes: [] as DrawingStroke[],
    active: new Map<string, DrawingStroke>(),
    userHistory: new Map<string, string[]>(),
    userRedo: new Map<string, DrawingStroke[]>(),
  },
  methods: (store) => ({
    begin(id: string, userId: string, color: string, width: number, x: number, y: number) {
      store.active.set(id, { id, userId, color, width, points: [{ x, y }] });
    },
    addPoint(id: string, point: DrawingPoint) {
      store.active.get(id)?.points.push(point);
    },
    end(id: string) {
      const stroke = store.active.get(id);
      if (!stroke) return;
      store.active.delete(id);
      store.strokes.push(stroke);
      if (store.strokes.length > 500) store.strokes.shift();
      const history = store.userHistory.get(stroke.userId) ?? [];
      history.push(id);
      store.userHistory.set(stroke.userId, history);
      store.userRedo.delete(stroke.userId);
    },
    undo(userId: string): string | null {
      const history = store.userHistory.get(userId);
      if (!history || history.length === 0) return null;
      const strokeId = history.pop()!;
      const idx = store.strokes.findIndex((s) => s.id === strokeId);
      if (idx === -1) return null;
      const [stroke] = store.strokes.splice(idx, 1);
      const redo = store.userRedo.get(userId) ?? [];
      redo.push(stroke!);
      store.userRedo.set(userId, redo);
      return strokeId;
    },
    redo(userId: string): DrawingStroke | null {
      const redoStack = store.userRedo.get(userId);
      if (!redoStack || redoStack.length === 0) return null;
      const stroke = redoStack.pop()!;
      store.strokes.push(stroke);
      const history = store.userHistory.get(userId) ?? [];
      history.push(stroke.id);
      store.userHistory.set(userId, history);
      return stroke;
    },
    clear() {
      store.strokes = [];
      store.active.clear();
      store.userHistory.clear();
      store.userRedo.clear();
    },
    all(): DrawingStroke[] { return store.strokes; },
  }),
});
