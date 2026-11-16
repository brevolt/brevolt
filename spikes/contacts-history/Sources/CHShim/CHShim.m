#import "CHShim.h"
@implementation CHShim
+ (NSArray<CNChangeHistoryEvent *> *)fetchHistory:(CNContactStore *)store
                                          request:(CNChangeHistoryFetchRequest *)request
                                         outToken:(NSData **)outToken
                                            error:(NSError **)error {
    CNFetchResult<NSEnumerator<CNChangeHistoryEvent *> *> *r =
        [store enumeratorForChangeHistoryFetchRequest:request error:error];
    if (!r) return nil;
    if (outToken) *outToken = r.currentHistoryToken;
    return r.value.allObjects;
}
@end
