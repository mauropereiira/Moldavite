import Foundation
import XCTest
@testable import MoldaviteCloud

final class CloudSessionTests: XCTestCase {
    func testUnavailableAndUninitializedSessionsNeverReturnALocalRoot() throws {
        let session = CloudSession()
        XCTAssertThrowsError(try session.root())
        let documents = CloudDocuments(root: URL(fileURLWithPath: "/tmp/cloud-session"))
        session.bind(documents)
        XCTAssertThrowsError(try session.root())
        session.apply(CloudChange(kind: "initial", items: [], removed: []), from: documents)
        XCTAssertEqual(try session.root(), documents.root)
        session.apply(CloudChange(kind: "accountChanged", items: [], removed: []), from: documents)
        XCTAssertThrowsError(try session.root())
    }

    func testAnOldQueryCannotInitializeAReplacementAccount() throws {
        let session = CloudSession()
        let first = CloudDocuments(root: URL(fileURLWithPath: "/tmp/first-cloud"))
        let second = CloudDocuments(root: URL(fileURLWithPath: "/tmp/second-cloud"))
        session.bind(first)
        session.bind(second)
        session.apply(CloudChange(kind: "initial", items: [], removed: []), from: first)
        XCTAssertThrowsError(try session.root())
        session.apply(CloudChange(kind: "initial", items: [], removed: []), from: second)
        XCTAssertEqual(try session.root(), second.root)
    }

    func testMetadataOnlyNamesCannotBeCreatedUntilTheirContentsArrive() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let documents = CloudDocuments(root: root)
        let session = CloudSession()
        session.bind(documents)
        let remote = CloudItem(path: "note.md", isDirectory: false, downloadState: .pending, isDownloading: false,
                               isUploading: false, hasConflicts: false, error: nil)
        session.apply(CloudChange(kind: "initial", items: [remote], removed: []), from: documents)
        let path = try documents.url(for: "note.md")
        XCTAssertFalse(FileManager.default.fileExists(atPath: path.path))
        XCTAssertThrowsError(try session.validateAccess(to: path))
        try Data("downloaded body".utf8).write(to: path)
        XCTAssertNoThrow(try session.validateAccess(to: path))
        XCTAssertNoThrow(try session.validateAccess(to: documents.url(for: "new-note.md")))
    }
}
