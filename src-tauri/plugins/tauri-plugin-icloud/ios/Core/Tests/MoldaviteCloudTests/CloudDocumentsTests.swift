import Foundation
import XCTest
@testable import MoldaviteCloud

final class CloudDocumentsTests: XCTestCase {
    private var root: URL!
    private var documents: CloudDocuments!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            .resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        documents = CloudDocuments(root: root)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: root)
    }

    func testFirstUseResolvesNativeContainerWithoutExistingFolder() throws {
        let fresh = root.appendingPathComponent("new-container")
        XCTAssertFalse(FileManager.default.fileExists(atPath: fresh.path))
        var calls = 0
        let cloud = try CloudDocuments.resolve(identity: { "account" as NSString }, container: {
            calls += 1
            return fresh
        })
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(cloud.root.path, fresh.appendingPathComponent("Documents", isDirectory: true).path)
    }

    func testUnavailableAccountDoesNotInitializeContainer() {
        XCTAssertThrowsError(try CloudDocuments.resolve(identity: { nil }, container: {
            XCTFail("Must not initialize a container without an account")
            return self.root
        }))
        XCTAssertThrowsError(try CloudDocuments.resolve(identity: { "account" as NSString },
                                                       container: { nil }))
    }

    func testAccountSwitchDuringAndAfterResolutionRejectsAccess() throws {
        var identity: NSString = "first"
        XCTAssertThrowsError(try CloudDocuments.resolve(identity: { identity }, container: {
            identity = "second"
            return self.root
        }))
        let cloud = try CloudDocuments.resolve(identity: { identity }, container: { self.root })
        identity = "third"
        XCTAssertThrowsError(try cloud.validateIdentity())
    }

    func testRejectsTraversalAbsolutePathsAndSymlinkedParents() throws {
        for path in ["", "/notes/a.md", "../a.md", "notes/../a.md", "notes//a.md",
                     "notes/./a.md", "notes\\a.md", "notes/a\0.md"] {
            XCTAssertThrowsError(try documents.url(for: path), path)
        }
        let link = root.appendingPathComponent("linked")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: root.deletingLastPathComponent())
        XCTAssertThrowsError(try documents.url(for: "linked/not-downloaded.md"))
        XCTAssertEqual(try documents.url(for: "notes/Málaga note.md").lastPathComponent, "Málaga note.md")
        XCTAssertNil(documents.relativePath(for: root.appendingPathComponent("../outside.md")))
        XCTAssertNil(documents.relativePath(for: URL(fileURLWithPath: root.path + "-other/note.md")))
    }

    func testPlaceholderIsPendingAndNeverReadAsContent() throws {
        try Data("placeholder metadata".utf8).write(to: root.appendingPathComponent(".note.md.icloud"))
        let item = try documents.item(at: "note.md")
        XCTAssertEqual(item.downloadState, .pending)
        XCTAssertFalse(item.downloadState.hasLocalContents)
        XCTAssertEqual(try documents.item(at: "absent.md").downloadState, .missing)
        // A downloaded local file can legitimately be empty; its size is not
        // a proxy for download readiness.
        try Data().write(to: root.appendingPathComponent("empty.md"))
        XCTAssertEqual(try documents.item(at: "empty.md").downloadState, .local)
    }

    func testUnknownCloudStatusDoesNotAuthorizeContentAccess() {
        XCTAssertEqual(DownloadState.from(status: nil, ubiquitous: true), .unknown)
        XCTAssertFalse(DownloadState.unknown.hasLocalContents)
        XCTAssertFalse(DownloadState.pending.hasLocalContents)
        XCTAssertFalse(DownloadState.missing.hasLocalContents)
        XCTAssertTrue(DownloadState.downloaded.hasLocalContents)
        XCTAssertEqual(DownloadState.from(status: .notDownloaded, ubiquitous: true), .pending)
        XCTAssertEqual(DownloadState.from(status: .current, ubiquitous: true), .current)
    }

    func testAccountChangeRejectsOldContainerAccess() {
        let stale = CloudDocuments(root: root) { throw CloudError.accountChanged }
        XCTAssertThrowsError(try stale.item(at: "note.md"))
        XCTAssertThrowsError(try stale.startDownloading("note.md"))
        XCTAssertNil(stale.relativePath(for: root.appendingPathComponent("note.md")))
    }
}
