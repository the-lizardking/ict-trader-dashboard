import streamlit as st
from data_sources import FakeDataSource
st.set_page_config(page_title="Accounts", layout="wide")
ds = FakeDataSource()
st.title("💼 Accounts")
df = ds.get_accounts_stats()
st.dataframe(df)
selected = st.selectbox("Account", df.index)
st.write(f"Details: {df.loc[selected].to_dict()}")
