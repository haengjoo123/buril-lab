const REQUIRED_ACKNOWLEDGEMENT = 'I_HAVE_WRITTEN_PERMISSION';

export function requireKoshaBulkCollectionPermission(environment = process.env) {
    if (environment.KOSHA_BULK_COLLECTION_ACK !== REQUIRED_ACKNOWLEDGEMENT) {
        throw new Error(
            'KOSHA bulk collection is frozen. Set KOSHA_BULK_COLLECTION_ACK=I_HAVE_WRITTEN_PERMISSION only after written permission is recorded.',
        );
    }
}
