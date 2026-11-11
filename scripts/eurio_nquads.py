"""Streaming RDFLib N-Quads parsing into occurrence-preserving SQLite rows."""
import hashlib
import rdflib
from rdflib import BNode, Literal, URIRef
from rdflib.plugins.parsers.nquads import NQuadsParser


class NativeBlankNodes(dict):
    """RDFLib's documented bnode_context mapping; member_id supplies document scope."""
    def get(self, key, default=None):
        return key


def term_kind(term):
    if isinstance(term, URIRef):
        return "uri"
    if isinstance(term, BNode):
        return "bnode"
    if isinstance(term, Literal):
        return "literal"
    raise ValueError("Unsupported RDF term")


class QuadSink:
    def __init__(self, db, member_id):
        self.db, self.member_id = db, member_id
        self.default_context = ContextSink(self, None)
        self.line_number, self.raw, self.count = 0, "", 0
        self.pending = []

    def get_context(self, graph):
        return ContextSink(self, graph)

    def add(self, triple, graph):
        subject, predicate, obj = triple
        self.pending.append((self.member_id, self.line_number, term_kind(subject), str(subject), str(predicate),
                             term_kind(obj), str(obj), obj.language if isinstance(obj, Literal) else None,
                             str(obj.datatype) if isinstance(obj, Literal) and obj.datatype else None,
                             term_kind(graph) if graph is not None else "default", str(graph) if graph is not None else None, self.raw))
        self.count += 1
        if len(self.pending) >= 5000:
            self.flush()

    def flush(self):
        self.db.executemany("INSERT INTO quads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", self.pending)
        self.pending.clear()


class ContextSink:
    def __init__(self, parent, graph):
        self.parent, self.graph = parent, graph

    def add(self, triple):
        self.parent.add(triple, self.graph)


def import_member(db, archive, info, member_id, max_line_bytes, progress=None):
    if rdflib.__version__ != "7.6.0":
        raise RuntimeError("This importer requires rdflib==7.6.0; use scripts/requirements.txt")
    sink = QuadSink(db, member_id)
    parser = NQuadsParser()
    parser.sink = sink
    parser.skolemize = False
    nodes = NativeBlankNodes()
    digest, size, line_number = hashlib.sha256(), 0, 0
    normalize = rdflib.NORMALIZE_LITERALS
    rdflib.NORMALIZE_LITERALS = False
    try:
        with archive.open(info) as source:
            while True:
                line = source.readline(max_line_bytes + 1)
                if not line:
                    break
                if len(line) > max_line_bytes:
                    raise ValueError("N-Quads line exceeds byte limit")
                digest.update(line)
                size += len(line)
                line_number += 1
                sink.line_number, sink.raw = line_number, line.decode("utf-8")
                parser.line = sink.raw.rstrip("\r\n")
                parser.parseline(nodes)
                if progress and line_number % 100000 == 0:
                    progress({"member": info.filename, "lines": line_number, "quads": sink.count, "bytes": size})
        sink.flush()
    finally:
        rdflib.NORMALIZE_LITERALS = normalize
    if size != info.file_size:
        raise ValueError("Incomplete N-Quads member")
    return digest.hexdigest(), size, sink.count
