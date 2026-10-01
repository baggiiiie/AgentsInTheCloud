// Rotates a booted simulator by sending the GSEvent that Simulator.app sends to
// the device's PurpleWorkspacePort. Xcode 27 has no Simulator.app, and neither
// simctl nor AXe can rotate. Layout taken from FBSimulatorControl's PurpleHID.
// Usage: ios-sim-orientation <udid> <1 portrait | 3 landscape-left | 4 landscape-right>
#import <Foundation/Foundation.h>
#import <mach/mach.h>
#import <dlfcn.h>

@interface SimServiceContext : NSObject
+ (instancetype)sharedServiceContextForDeveloperDir:(NSString *)dir error:(NSError **)error;
- (id)defaultDeviceSetWithError:(NSError **)error;
@end
@interface SimDevice : NSObject
- (NSUUID *)UDID;
- (mach_port_t)lookup:(NSString *)name error:(NSError **)error;
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) { fprintf(stderr, "usage: %s <udid> <1-4>\n", argv[0]); return 2; }
    int orientation = atoi(argv[2]);
    if (orientation < 1 || orientation > 4) { fprintf(stderr, "orientation must be 1-4\n"); return 2; }
    if (!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW)) { fprintf(stderr, "%s\n", dlerror()); return 1; }
    NSTask *select = [NSTask new];
    select.launchPath = @"/usr/bin/xcode-select"; select.arguments = @[@"-p"];
    NSPipe *pipe = [NSPipe pipe]; select.standardOutput = pipe;
    [select launch]; [select waitUntilExit];
    NSString *developerDir = [[[NSString alloc] initWithData:pipe.fileHandleForReading.readDataToEndOfFile encoding:NSUTF8StringEncoding] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSError *error = nil;
    SimServiceContext *context = [NSClassFromString(@"SimServiceContext") sharedServiceContextForDeveloperDir:developerDir error:&error];
    if (!context) { fprintf(stderr, "%s\n", error.description.UTF8String); return 1; }
    id set = [context defaultDeviceSetWithError:&error];
    if (!set) { fprintf(stderr, "%s\n", error.description.UTF8String); return 1; }
    SimDevice *device = nil;
    for (SimDevice *candidate in [set valueForKey:@"devices"])
      if ([candidate.UDID.UUIDString isEqualToString:[NSString stringWithUTF8String:argv[1]]]) device = candidate;
    if (!device) { fprintf(stderr, "No simulator with UDID %s\n", argv[1]); return 1; }
    mach_port_t port = [device lookup:@"PurpleWorkspacePort" error:&error];
    if (port == MACH_PORT_NULL) { fprintf(stderr, "PurpleWorkspacePort unavailable: %s\n", error.description.UTF8String); return 1; }
    uint8_t message[0x70] = {0};
    uint32_t *words = (uint32_t *)message;
    words[0x00 / 4] = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
    words[0x04 / 4] = 0x6c;              // msgh_size
    words[0x08 / 4] = port;              // msgh_remote_port
    words[0x14 / 4] = 0x7b;              // msgh_id
    words[0x18 / 4] = 0x20032;           // GSEventTypeDeviceOrientationChanged | GSEventHostFlag
    words[0x48 / 4] = 4;                 // info size
    words[0x4c / 4] = (uint32_t)orientation;
    kern_return_t result = mach_msg((mach_msg_header_t *)message, MACH_SEND_MSG | MACH_SEND_TIMEOUT, 0x6c, 0, MACH_PORT_NULL, 1000, MACH_PORT_NULL);
    if (result != KERN_SUCCESS) { fprintf(stderr, "mach_msg: %s\n", mach_error_string(result)); return 1; }
  }
  return 0;
}
