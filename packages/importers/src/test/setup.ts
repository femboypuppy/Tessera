import { configure } from '@testing-library/react';

// The UI tests wait for real work (lazy chunks, file reading, whole imports), which takes longer
// than Testing Library's default second when the monorepo's suite shares the machine.
configure({ asyncUtilTimeout: 10_000 });
