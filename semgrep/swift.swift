import SwiftUI

struct Fixture: View {
    var body: some View {
        VStack {
            // ruleid: std.swift.raw-color
            Text("a").foregroundColor(Color(red: 1, green: 0, blue: 0))
            // ruleid: std.swift.raw-color
            Text("b").foregroundColor(Color.red)
            // ok: std.swift.raw-color
            Text("c").foregroundColor(colors.statusDanger)
            // ruleid: std.swift.font-literal
            Text("d").font(.system(size: 14))
            // ruleid: std.swift.icons-direct
            Image(systemName: "trash")
            // ok: std.swift.icons-direct
            AppIcon.actionDelete
        }
    }

    func f() {
        // ruleid: std.swift.print
        print("hello")
        // ok: std.swift.print
        logger.info("thing.done")
        // ruleid: std.swift.userdefaults-secret
        UserDefaults.standard.set(t, forKey: "authToken")
        // ok: std.swift.userdefaults-secret
        UserDefaults.standard.set(true, forKey: "onboarded")
    }
}
