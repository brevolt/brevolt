#import <Contacts/Contacts.h>
NS_ASSUME_NONNULL_BEGIN
@interface CHShim : NSObject
/// Fetches change-history events (nil + error on failure); also returns the new history token.
+ (NSArray<CNChangeHistoryEvent *> *_Nullable)fetchHistory:(CNContactStore *)store
                                                   request:(CNChangeHistoryFetchRequest *)request
                                                  outToken:(NSData *_Nullable *_Nullable)outToken
                                                     error:(NSError *_Nullable *_Nullable)error;
@end
NS_ASSUME_NONNULL_END
