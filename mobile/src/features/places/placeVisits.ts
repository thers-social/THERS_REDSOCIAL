import { recordPlaceVisit } from './api';
import { createVisitTracker } from './visitTracker';

/** Cuenta una visita anónima a la ficha (ADR-040 §33). Ver `visitTracker.ts`. */
export const trackPlaceVisit = createVisitTracker((placeId, event) => recordPlaceVisit(placeId, event));
