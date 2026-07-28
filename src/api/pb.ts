import PocketBase from 'pocketbase';

// PocketBase URL — will be configured for production
const PB_URL = import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090';

const pb = new PocketBase(PB_URL);

// Disable auto-cancellation so multiple requests can run simultaneously
pb.autoCancellation(false);

export default pb;
