import { useCallback, useEffect, useRef, useState } from "react";
import {
  canAct,
  cardStateFromError,
  checkMessage,
  chatErrorKind,
  confirmedNoteKey,
  historyForRequest,
  initialCardState,
  makeMessage,
  moodForOutcome,
  normalizeError,
  SETTLE_AFTER_MS,
  withStatus,
} from "../lib/teroChat";
import { cancelTeroAction, confirmTeroAction, sendToTero } from "../lib/teroClient";

/**
 * Estado de la conversación con Tero. La conversación vive SOLO en memoria: el
 * servidor no guarda historial (ADR-041 §5.2) y cerrar la pestaña la borra.
 *
 * `sync` avisa a quien lo usa de que una acción confirmada cambió datos reales
 * (por ejemplo, seguir a alguien) para que pueda refrescar lo que muestra.
 */
export default function useTeroChat({ context, onActionConfirmed }) {
  const [messages, setMessages] = useState([]);
  const [cardStates, setCardStates] = useState({});
  const [mood, setMood] = useState("idle");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null); // clave: offline, rateLimited...
  const [inputError, setInputError] = useState(null); // clave: empty, tooLong

  const abortRef = useRef(null);
  const settleRef = useRef(null);
  // Refs para que `send` no dependa de estado que cambia en cada mensaje.
  const messagesRef = useRef(messages);
  const cardStatesRef = useRef(cardStates);
  const contextRef = useRef(context);
  useEffect(() => {
    messagesRef.current = messages;
    cardStatesRef.current = cardStates;
    contextRef.current = context;
  });

  const settleLater = useCallback(() => {
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => setMood("idle"), SETTLE_AFTER_MS);
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      clearTimeout(settleRef.current);
    },
    []
  );

  const send = useCallback(
    async (input, { retryId } = {}) => {
      const check = checkMessage(input);
      if (!check.ok) {
        setInputError(check.error);
        return false;
      }
      setInputError(null);
      setError(null);
      clearTimeout(settleRef.current);

      let userId = retryId;
      let base = messagesRef.current;
      if (!userId) {
        const message = makeMessage("user", check.text);
        userId = message.id;
        base = [...base, message];
      } else {
        base = withStatus(base, userId, "sending");
      }
      setMessages(base);
      setPending(true);
      setMood("thinking");

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const history = historyForRequest(base, userId, cardStatesRef.current);
        const reply = await sendToTero(check.text, contextRef.current, history, controller.signal);
        const answer = makeMessage("tero", reply.text);
        if (reply.cards.length) answer.cards = reply.cards;
        setMessages((prev) => [...withStatus(prev, userId, "sent"), answer]);
        if (reply.cards.length) {
          setCardStates((prev) => {
            const next = { ...prev };
            reply.cards.forEach((card) => {
              next[card.id] = initialCardState(card);
            });
            return next;
          });
        }
        setMood(reply.mood);
        if (reply.mood === "speaking") settleLater();
      } catch (e) {
        if (controller.signal.aborted) return false;
        setMessages((prev) => withStatus(prev, userId, "failed"));
        setError(chatErrorKind(normalizeError(e)));
        setMood("error");
        settleLater();
        return false;
      } finally {
        setPending(false);
      }
      return true;
    },
    [settleLater]
  );

  const settleCard = useCallback(
    (cardId, state) => {
      setCardStates((prev) => ({ ...prev, [cardId]: state }));
      const next = moodForOutcome(state.status);
      if (next) {
        setMood(next);
        settleLater();
      }
    },
    [settleLater]
  );

  // Solo la llama la persona, al pulsar «Confirmar»: Tero nunca la dispara.
  const confirm = useCallback(
    async (card) => {
      const state = cardStatesRef.current[card.id] ?? initialCardState(card);
      if (!canAct(state, card)) return;
      setCardStates((prev) => ({ ...prev, [card.id]: { status: "confirming" } }));
      try {
        const payload = await confirmTeroAction(card.id);
        settleCard(card.id, { status: "confirmed", note: confirmedNoteKey(payload) });
        onActionConfirmed?.(card, payload);
      } catch (e) {
        settleCard(card.id, cardStateFromError(normalizeError(e)));
      }
    },
    [onActionConfirmed, settleCard]
  );

  const cancel = useCallback(
    async (card) => {
      const state = cardStatesRef.current[card.id] ?? initialCardState(card);
      if (!canAct(state, card)) return;
      setCardStates((prev) => ({ ...prev, [card.id]: { status: "cancelling" } }));
      try {
        await cancelTeroAction(card.id);
        settleCard(card.id, { status: "cancelled", note: "cancelled" });
      } catch (e) {
        settleCard(card.id, cardStateFromError(normalizeError(e)));
      }
    },
    [settleCard]
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setCardStates({});
    setError(null);
    setInputError(null);
    setPending(false);
    setMood("idle");
  }, []);

  return { messages, cardStates, mood, pending, error, inputError, send, confirm, cancel, clear };
}
