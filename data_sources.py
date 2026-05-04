from abc import ABC, abstractmethod
import pandas as pd
from faker import Faker
import paramiko

class BaseDataSource(ABC):
    @abstractmethod
    def load_data(self):
        pass

    @abstractmethod
    def validate_connection(self):
        pass


class FakeDataSource(BaseDataSource):
    def __init__(self):
        self.faker = Faker()

    def load_data(self):
        # Example of generating synthetic data
        data = {
            'name': [self.faker.name() for _ in range(10)],
            'address': [self.faker.address() for _ in range(10)]
        }
        return pd.DataFrame(data)

    def validate_connection(self):
        # Fake validation
        return True


class SSHDataSource(BaseDataSource):
    def __init__(self, hostname, port, username, password):
        self.hostname = hostname
        self.port = port
        self.username = username
        self.password = password

    def load_data(self):
        # Connect via SSH and load data
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(self.hostname, port=self.port, username=self.username, password=self.password)
        stdin, stdout, stderr = client.exec_command('cat /path/to/data')
        data = stdout.read().decode('utf-8')
        client.close()
        return data

    def validate_connection(self):
        # Validate SSH connection
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(self.hostname, port=self.port, username=self.username, password=self.password)
            client.close()
            return True
        except Exception:
            return False