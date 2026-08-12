import { useEffect, useRef, useState } from 'react';
import InboxValid from '../../widget/src/index.js';

export function useInboxValid(options = {}) {
  const inputRef = useRef(null);
  const validatorRef = useRef(null);
  const [state, setState] = useState({ state: 'empty', email: '', reason: null, code: null, suggestion: null, checks: {}, source: null });


  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!inputRef.current) return undefined;

    const validator = InboxValid.attach(inputRef.current, {
      ...optionsRef.current,
      headless: true,
      onChange: setState,
    });
    validatorRef.current = validator;

    return () => {
      validator.destroy();
      validatorRef.current = null;
    };
  }, []);

  return {
    inputRef,
    state,
    acceptSuggestion: () => validatorRef.current?.accept(),
    revalidate: () => validatorRef.current?.revalidate(),
  };
}
